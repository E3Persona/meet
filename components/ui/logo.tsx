import React from 'react';
export interface MswafiLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function MswafiLogo({ size = 'md', className }: MswafiLogoProps) {
  const sizeMap = {
    sm: { svg: 32, text: 'text-lg', gap: 'gap-2', mb: 'mb-4' },
    md: { svg: 64, text: 'text-2xl', gap: 'gap-3', mb: 'mb-8' },
    lg: { svg: 96, text: 'text-4xl', gap: 'gap-4', mb: 'mb-12' }
  };

  const { svg, text, gap, mb } = sizeMap[size];

  return (
    <div className={`flex items-center ${gap} ${mb} ${className}`}>
      <svg width={svg} height={svg} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#logoGrad)" />
        <rect x="1" y="1" width="62" height="30" rx="15" fill="white" fillOpacity="0.08" />
        <path d="M37 10L24 33H32L27 54L44 27H36L37 10Z" fill="white" fillOpacity="0.95" />
      </svg>
      <h1 className={`${text} font-bold tracking-tight bg-gradient-to-br from-blue-400 to-blue-600 bg-clip-text text-transparent`}>
        Mswafi
      </h1>
    </div>
  );
}
