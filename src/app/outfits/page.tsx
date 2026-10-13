import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PersonalEmpty } from "@/components/personal-empty";
import { getPublicCapabilities } from "@/server/config/capabilities";
export const metadata: Metadata = { title: "Образы на день" };
export const dynamic = "force-dynamic";
export default function OutfitsPage() {
  return (
    <AppShell mode="personal" active="outfits">
      <PersonalEmpty kind="outfits" {...getPublicCapabilities()} />
    </AppShell>
  );
}
