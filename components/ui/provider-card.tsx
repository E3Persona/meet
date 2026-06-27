"use client"
import { Card, CardContent } from "./card"
import { Avatar, AvatarFallback, AvatarImage } from "./avatar"
import { Text } from "./text"
import { Badge } from "./badge"
import { Star } from "lucide-react"


interface ProviderCardProps {
  provider: any
}

export function ProviderCard({ provider }: ProviderCardProps) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-4">
        <Avatar className="h-16 w-16 shrink-0 rounded-full">
          <AvatarImage
            src={provider.user?.profilePhotoUrl || ""}
            className="object-cover"
          />
          <AvatarFallback>
            {provider.user?.fullName?.charAt(0) || "P"}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <Text variant="body" className="truncate text-lg font-bold">
            {provider.user?.fullName}
          </Text>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="neutral">
              {provider.providerType === "MAMA_FUA" ? "Mama Fua" : "House Help"}
            </Badge>
            <div className="flex items-center text-sm text-amber-500">
              <Star className="h-3.5 w-3.5 fill-current" />
              <span>{Number(provider.avgRating || 0).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
