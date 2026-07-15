import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/devices": "Devices",
  "/pair": "Pair Device",
  "/apps": "Installed Apps",
  "/usage": "Usage",
  "/alerts": "Alerts",
  "/settings": "Settings",
};

function AppLayout() {
  const { session, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" replace />;

  let title = "AntiSlot Parent";
  for (const k of Object.keys(titles)) {
    if (pathname === k || pathname.startsWith(k + "/")) {
      title = titles[k];
      break;
    }
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mx-2 h-5" />
            <h1 className="text-sm font-semibold">{title}</h1>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
