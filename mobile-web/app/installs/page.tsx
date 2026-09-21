import { ActiveProjectsScreen } from "@/components/ActiveProjectsScreen";

export default function InstallsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))] dark:bg-slate-950 sm:px-5">
      <div className="mx-auto max-w-lg">
        <ActiveProjectsScreen />
      </div>
    </main>
  );
}
