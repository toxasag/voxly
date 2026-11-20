# Формы, валидация и серверные соглашения (Fastify)

> Вынесено без изменений смысла из `AGENTS.md` проекта GETVOXLY (исходные строки 387–555 прежней версии; прежний полный файл — коммит `1115feb`/`4cc8860`). Читай этот файл перед работой в соответствующей области.

## 7. FORM & VALIDATION STANDARDS

Every form follows this pattern:

```tsx
// schemas/contact.schema.ts
import { z } from 'zod';

export const createContactSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  company_id: z.string().uuid().optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

export type CreateContactPayload = z.infer<typeof createContactSchema>;

// components/core/contacts/create-contact-form.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactSchema, type CreateContactPayload } from '@/schemas/contact.schema';

export function CreateContactForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<CreateContactPayload>({
    resolver: zodResolver(createContactSchema),
    defaultValues: { first_name: '', last_name: '', email: '', phone: '', custom_fields: {} },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateContactPayload) => apiClient.post('/api/contacts', data),
    onSuccess,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input {...field} className="border-[#e5e5e5] bg-white text-[#111111] focus:border-[#4a38f5]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ...remaining fields */}
        <Button type="submit" disabled={mutation.isPending} className="bg-[#4a38f5] text-white hover:bg-[#3d2ee0]">
          {mutation.isPending ? 'Saving...' : 'Create Contact'}
        </Button>
      </form>
    </Form>
  );
}
```

Rules:
- Zod schemas live in `schemas/` and are reused for both client validation and server-side request validation (keep them in sync).
- Field names in schemas use `snake_case` (database column convention), but the Zod `.transform()` can convert to camelCase for the frontend if the team decides.
- All mutations show loading state (`isPending`), disable the submit button, and surface validation errors via `<FormMessage />`.
- Server-side `4xx` errors are parsed and displayed via `form.setError()` using `onError` in `useMutation`.

---

## 8. SERVER-SIDE CONVENTIONS (Fastify)

### Route Definition Pattern

```typescript
// backend/src/routes/contact-routes.ts
import type { FastifyInstance } from 'fastify';
import { createContactSchema } from '../../shared/schemas/contact.schema'; // shared schemas package

export async function contactRoutes(app: FastifyInstance) {
  // All routes require authentication + tenant context
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requirePermission('contacts:read'));

  app.get('/contacts', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 25, maximum: 100 },
        },
      },
    },
    handler: async (request, reply) => {
      const { tenant_id } = request;
      const { search, page, limit } = request.query as { search?: string; page: number; limit: number };
      const offset = (page - 1) * limit;

      const contacts = await app.db.query(
        `SELECT * FROM contacts
         WHERE tenant_id = $1
           AND ($2::text IS NULL OR full_text @@ plainto_tsquery($2))
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [tenant_id, search ?? null, limit, offset]
      );

      return reply.send({ data: contacts, page, limit });
    },
  });

  app.post('/contacts', {
    schema: { body: createContactSchema }, // reuse Zod schema + ajv compilation
    handler: async (request, reply) => {
      const { tenant_id } = request;
      const payload = request.body;

      const [contact] = await app.db.query(
        `INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, company_id, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [tenant_id, payload.first_name, payload.last_name, payload.email, payload.phone, payload.company_id, JSON.stringify(payload.custom_fields ?? {})]
      );

      return reply.status(201).send(contact);
    },
  });
}
```

### Middleware Decorators
```typescript
// backend/src/plugins/auth.ts
declare module 'fastify' {
  interface FastifyRequest {
    tenant_id: string;
    user_id: string;
    permissions: Set<string>;
    installed_modules: string[];
  }
}
```

### Background Jobs (BullMQ)
- Queue names: `email`, `export`, `ai-bots`, `notifications`.
- All job handlers read `tenant_id` from the job payload. Job data is scoped to the tenant.
- Retry policies: exponential backoff, max 5 attempts, dead-letter to a `failed-jobs` queue.

### API Response Envelope
```typescript
interface ApiResponse<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

interface ApiError {
  error: {
    code: string;       // 'VALIDATION_ERROR', 'NOT_FOUND', 'PERMISSION_DENIED', etc.
    message: string;
    details?: Record<string, string[]>; // field-level errors
  };
}
```
