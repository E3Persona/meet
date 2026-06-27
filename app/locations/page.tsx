import { LocationsManager } from "@/components/locations/locations-manager"

export default function LocationsPage() {
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations & Search Terms</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage venues and the event-type keywords used for discovery.
          </p>
        </div>
        <LocationsManager />
      </div>
    </div>
  )
}
