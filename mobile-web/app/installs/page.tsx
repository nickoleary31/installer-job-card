import { ActiveProjectsScreen } from "@/components/ActiveProjectsScreen";

export default function InstallsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-10 pt-6 dark:bg-slate-950 sm:px-5">
      <div className="mx-auto max-w-lg">
        <ActiveProjectsScreen />
      </div>
    </main>
  );
}
