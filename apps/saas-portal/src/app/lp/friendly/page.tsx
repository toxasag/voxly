import { redirect } from 'next/navigation';

/** Alias kept after promote — friendly LP is now `/`. */
export default async function FriendlyLandingAlias({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const q = ref?.trim() ? `?ref=${encodeURIComponent(ref.trim())}` : '';
  redirect(`/${q}`);
}
