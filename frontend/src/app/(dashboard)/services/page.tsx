"use client";

import { useState, Suspense } from "react";
import { BookOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceList } from "@/components/services/ServiceList";
import { CreateOrEditServiceModal } from "@/components/warehouse/CreateOrEditServiceModal";

function ServicesPageContent() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 border-b border-[#e5e5e5] bg-white">
        <div className="flex items-center gap-3">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-2 shadow-2xs">
            <BookOpen className="h-5 w-5 text-[#4a38f5]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#111111]">Справочник услуг</h1>
            <p className="text-xs text-[#666666]">
              Каталог типовых работ, услуг и базовых цен сервисного центра
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 shadow-2xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Добавить услугу</span>
        </Button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0">
        <ServiceList />
      </div>

      {/* Modal for creating new service */}
      <CreateOrEditServiceModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        service={null}
      />
    </div>
  );
}

export default function ServicesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#888888]">Загрузка справочника услуг...</div>}>
      <ServicesPageContent />
    </Suspense>
  );
}
