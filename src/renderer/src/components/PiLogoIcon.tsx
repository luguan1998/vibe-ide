import React from 'react'

export function PiLogoIcon({ size = '1em', className, fill = 'currentColor' }: { size?: number | string; className?: string; fill?: string }) {
  return (
    <svg height={size} width={size} className={className} style={{ flex: 'none', lineHeight: 1 }} viewBox="-4 -4 37 37" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" clipRule="evenodd" d="M1 1H22V14.4997H14.9998V21.2499H8.0002V28H1V1ZM8.0002 7.75014V14.4997H14.9998V7.75014H8.0002Z" fill={fill} />
      <path d="M22 15H28V28H22V15Z" fill={fill} />
    </svg>
  )
}
