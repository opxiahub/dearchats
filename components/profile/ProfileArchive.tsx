"use client";

import { useState } from "react";
import UploadDropZone from "@/components/landing/UploadDropZone";
import GenerationList, { type GenerationSummary } from "@/components/profile/GenerationList";

export default function ProfileArchive({
  initialItems,
}: {
  initialItems: GenerationSummary[];
}) {
  const [items, setItems] = useState(initialItems);

  return (
    <div className="space-y-10 w-full max-w-full overflow-x-hidden">
      <section className="w-full max-w-full overflow-x-hidden">
        <p className="text-[10px] tracking-[0.32em] sm:tracking-[0.4em] uppercase text-mist/60 mb-3 overflow-wrap-anywhere">upload new chat</p>
        <h1 className="serif display-lg text-parchment text-balance mb-5 overflow-wrap-anywhere">Start another walk.</h1>
        <UploadDropZone signedIn wide />
      </section>

      <section className="w-full max-w-full overflow-x-hidden">
        <div className="mb-5">
          <p className="text-[10px] tracking-[0.32em] sm:tracking-[0.4em] uppercase text-mist/60 mb-3 overflow-wrap-anywhere">your archive</p>
          <h2 className="serif display-md text-parchment text-balance overflow-wrap-anywhere">Past generations.</h2>
        </div>
        <GenerationList initialItems={initialItems} items={items} onItemsChange={setItems} />
      </section>
    </div>
  );
}
