"use client"

import { useState, useEffect } from "react"

type Breakpoint = "sm" | "md" | "lg" | "xl"

const breakpointWidths: Record<Breakpoint, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
}

export function useResponsive(breakpoint: Breakpoint = "md") {
  const [isBelowBreakpoint, setIsBelowBreakpoint] = useState(false)

  useEffect(() => {
    const checkBreakpoint = () => {
      setIsBelowBreakpoint(window.innerWidth < breakpointWidths[breakpoint])
    }

    // Initial check
    checkBreakpoint()

    // Add event listener
    window.addEventListener("resize", checkBreakpoint)

    // Cleanup
    return () => window.removeEventListener("resize", checkBreakpoint)
  }, [breakpoint])

  return isBelowBreakpoint
}
