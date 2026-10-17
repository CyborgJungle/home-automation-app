import { Gate } from "@/components/gate";
import { TabBar, Toasts } from "@/components/ui";
import { HomeProvider } from "@/lib/home";

// The three tabs share one live connection, so switching between them is instant.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <HomeProvider>
      <Gate>{children}</Gate>
      <Toasts />
      <TabBar />
    </HomeProvider>
  );
}
