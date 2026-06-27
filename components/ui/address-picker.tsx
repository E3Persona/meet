"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import dynamic from "next/dynamic"
import { useMap } from "react-leaflet"
import type { Marker as LeafletMarker } from "leaflet"
import "leaflet/dist/leaflet.css"
import { Input } from "./input"
import { Label } from "./label"
import { Button } from "./button"
import { Loader2, MapPin, Search } from "lucide-react"
import { cn } from "@/lib/utils"

const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
)
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
)
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
)
const Popup = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), {
  ssr: false,
})

export interface AddressValue {
  address: string
  city: string
  state: string
  country: string
  zipCode: string
  latitude: number | null
  longitude: number | null
}

interface AddressPickerProps {
  value: AddressValue
  onChange: (value: AddressValue) => void
  label?: string
  error?: string
  required?: boolean
  className?: string
}

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  address: {
    road?: string
    house_number?: string
    city?: string
    town?: string
    village?: string
    state?: string
    country?: string
    postcode?: string
  }
}

function parseAddress(result: NominatimResult): {
  street: string
  city: string
  state: string
  country: string
  zipCode: string
} {
  const a = result.address
  const street = [a.house_number, a.road].filter(Boolean).join(" ") || ""
  const city = a.city || a.town || a.village || ""
  return {
    street,
    city,
    state: a.state || "",
    country: a.country || "",
    zipCode: a.postcode || "",
  }
}

function pickSuggestion(result: NominatimResult): AddressValue {
  const parsed = parseAddress(result)
  const lat = parseFloat(result.lat)
  const lon = parseFloat(result.lon)
  return {
    address: parsed.street || (result.display_name.split(",")[0] ?? ""),
    city: parsed.city,
    state: parsed.state,
    country: parsed.country,
    zipCode: parsed.zipCode,
    latitude: lat,
    longitude: lon,
  }
}

function truncateDisplayName(name: string, maxLen = 80): string {
  if (name.length <= maxLen) return name
  return name.slice(0, maxLen).trimEnd() + "..."
}

function MapRecenterInner({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    // Container can mount at 0 size before CSS/layout settles — force a
    // size recalculation before flying to the target, or the tile grid
    // renders squished/shaky.
    map.invalidateSize()
    map.flyTo(center, 16, { duration: 1.5 })
  }, [center, map])
  return null
}

const MapRecenter = dynamic(() => Promise.resolve(MapRecenterInner), {
  ssr: false,
})

// Patches react-leaflet's default marker icon, which otherwise 404s under
// webpack/Next bundling (a long-standing upstream react-leaflet issue).
function MapIconPatchInner() {
  useEffect(() => {
    ;(async () => {
      const L = await import("leaflet")
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
        ._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      })
    })()
  }, [])
  return null
}

const MapIconPatch = dynamic(() => Promise.resolve(MapIconPatchInner), {
  ssr: false,
})

const DEBOUNCE_MS = 400
const SUGGESTION_LIMIT = 5

export function AddressPicker({
  value,
  onChange,
  label,
  error,
  required,
  className,
}: AddressPickerProps) {
  const [searchQuery, setSearchQuery] = useState(value.address || "")
  const [searching, setSearching] = useState(false)
  const [mapError, setMapError] = useState("")
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const markerRef = useRef<LeafletMarker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const defaultCenter: [number, number] = [20, 0]
  const center: [number, number] =
    value.latitude != null && value.longitude != null
      ? [value.latitude, value.longitude]
      : defaultCenter

  // Debounced autocomplete search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const query = searchQuery.trim()
    if (query.length < 3) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${SUGGESTION_LIMIT}&addressdetails=1`,
          {
            headers: {
              "Accept-Language": "en",
              "User-Agent": "Frafer-CRM/1.0",
            },
          }
        )
        const results: NominatimResult[] = await res.json()
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
        setHighlightedIndex(-1)
      } catch {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery])

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectSuggestion = useCallback(
    (result: NominatimResult) => {
      const parsed = pickSuggestion(result)
      onChange(parsed)
      setSearchQuery(result.display_name.split(",").slice(0, 3).join(","))
      setShowSuggestions(false)
      setSuggestions([])
      setHighlightedIndex(-1)
      setMapError("")
    },
    [onChange]
  )

  // Single-result geocode (search button / Enter with no suggestions)
  const geocode = useCallback(
    async (query: string) => {
      if (!query.trim()) return
      setSearching(true)
      setMapError("")
      setShowSuggestions(false)

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`,
          {
            headers: {
              "Accept-Language": "en",
              "User-Agent": "Frafer-CRM/1.0",
            },
          }
        )
        const results: NominatimResult[] = await res.json()

        if (results.length === 0) {
          setMapError("No results found. Try a different search.")
          return
        }

        const result = results[0]
        if (!result) return
        const parsed = pickSuggestion(result)
        onChange(parsed)
        setSearchQuery(result.display_name.split(",").slice(0, 3).join(","))
      } catch {
        setMapError("Geocoding failed. Try again.")
      } finally {
        setSearching(false)
      }
    },
    [onChange]
  )

  const handleMarkerDragEnd = useCallback(() => {
    const marker = markerRef.current
    if (!marker) return
    const pos = marker.getLatLng()
    onChange({
      ...value,
      latitude: pos.lat,
      longitude: pos.lng,
    })
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.lat}&lon=${pos.lng}`,
      { headers: { "Accept-Language": "en", "User-Agent": "Frafer-CRM/1.0" } }
    )
      .then((r) => r.json())
      .then((result: NominatimResult) => {
        const parsed = parseAddress(result)
        onChange({
          address: parsed.street || value.address,
          city: parsed.city || value.city,
          state: parsed.state || value.state,
          country: parsed.country || value.country,
          zipCode: parsed.zipCode || value.zipCode,
          latitude: pos.lat,
          longitude: pos.lng,
        })
        setSearchQuery(result.display_name.split(",").slice(0, 3).join(","))
      })
      .catch(() => {})
  }, [value, onChange])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") {
        e.preventDefault()
        geocode(searchQuery)
      }
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        )
        break
      case "Enter":
        e.preventDefault()
        if (highlightedIndex >= 0) {
          selectSuggestion(suggestions[highlightedIndex]!)
        } else if (suggestions.length > 0) {
          selectSuggestion(suggestions[0]!)
        }
        break
      case "Escape":
        setShowSuggestions(false)
        setHighlightedIndex(-1)
        break
    }
  }

  return (
    <div className={className}>
      {label && (
        <Label className="mb-1.5 block text-sm font-medium">
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
      )}

      {/* Search input + autocomplete dropdown */}
      <div ref={containerRef} className="relative mb-3">
        <Search className="absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchQuery(e.target.value)
            setMapError("")
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true)
          }}
          placeholder="Search address..."
          className="pr-20 pl-9"
          autoComplete="off"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => geocode(searchQuery)}
          disabled={searching || !searchQuery.trim()}
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
        </Button>

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            {suggestions.map((result, i) => (
              <button
                key={`${result.lat}-${result.lon}-${i}`}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                  highlightedIndex === i
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent/50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(result)
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="leading-tight">
                  {truncateDisplayName(result.display_name)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {mapError && <p className="mb-2 text-xs text-destructive">{mapError}</p>}

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <div className="relative h-64 w-full overflow-hidden rounded-lg border border-border">
        {value.latitude != null && value.longitude != null ? (
          <MapContainer
            center={center}
            zoom={16}
            style={{ height: "100%", width: "100%" }}
          >
            <MapIconPatch />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker
              position={center}
              draggable
              ref={markerRef}
              eventHandlers={{ dragend: handleMarkerDragEnd }}
            >
              <Popup>Drag to adjust location</Popup>
            </Marker>
            <MapRecenter center={center} />
          </MapContainer>
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/30">
            <div className="text-center">
              <MapPin className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                Search for an address to see it on the map
              </p>
            </div>
          </div>
        )}
      </div>

      {value.latitude != null && value.longitude != null && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Pin: {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)} — drag
          marker to adjust
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs">Address</Label>
          <Input
            value={value.address}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, address: e.target.value })
            }
            placeholder="Street address"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">City</Label>
          <Input
            value={value.city}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, city: e.target.value })
            }
            placeholder="City"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">State / Province</Label>
          <Input
            value={value.state}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, state: e.target.value })
            }
            placeholder="State"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Country</Label>
          <Input
            value={value.country}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, country: e.target.value })
            }
            placeholder="Country"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">ZIP Code</Label>
          <Input
            value={value.zipCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, zipCode: e.target.value })
            }
            placeholder="ZIP"
            className="mt-1"
          />
        </div>
      </div>
    </div>
  )
}
