// lib/page-shell/error-state.tsx

import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "../button";
import { AppIcon, IconText } from "../icon";
import { Text } from "../text";
import { PageShellError } from "@/types/components";


interface ErrorStateProps {
  error: PageShellError;
  onRetry?: () => void;
  onBack?: () => void;
}

export function ErrorState({ error, onRetry, onBack }: ErrorStateProps) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AppIcon icon={AlertCircle} size="lg" className="text-destructive" />
      </div>

      <div className="flex flex-col gap-1.5 max-w-sm">
        <Text variant="h3" className="text-base font-semibold text-foreground">
          {error.code ? `Error ${error.code} — ` : ""}
          {error.message}
        </Text>
        {error.detail && (
          <Text variant="bodyMuted" className="text-sm">
            {error.detail}
          </Text>
        )}
        {!error.detail && (
          <Text variant="bodyMuted" className="text-sm">
            We couldn't load this page. Please try again or go back.
          </Text>
        )}
      </div>

      <div className="flex items-center gap-3">
        {error.retryable !== false && onRetry && (
          <Button onClick={onRetry} size="sm" className="gap-2">
            <IconText 
              icon={RefreshCw} 
              iconSize="sm" 
              spacing="xs"
              as="span"
            >
              Try again
            </IconText>
          </Button>
        )}
        {onBack && (
          <Button onClick={onBack} variant="ghost" size="sm" className="gap-2">
            <IconText 
              icon={ArrowLeft} 
              iconSize="sm" 
              spacing="xs"
              as="span"
            >
              Go back
            </IconText>
          </Button>
        )}
      </div>
    </div>
  );
}