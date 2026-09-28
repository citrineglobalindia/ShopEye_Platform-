// SRS: CUST-FR-154 (product photos: responsive sizes and AVIF/WebP from Vercel's image CDN for ShopEye-hosted photos; lazy below the fold,
// eager with high priority for the main product photo; anything not hosted by ShopEye still lazy-loads as a plain image)
import Image from 'next/image';
const OPTIMISABLE = /^https:\/\/byaaaesufrneivzcsxtv\.supabase\.co\/storage\/v1\/object\/public\//;
export function Pic({ src, alt, w = 600, h = 750, sizes = '(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 260px', priority = false, className }:
  { src: string; alt: string; w?: number; h?: number; sizes?: string; priority?: boolean; className?: string }) {
  if (OPTIMISABLE.test(src)) return <Image src={src} alt={alt} width={w} height={h} sizes={sizes} priority={priority} className={className} />;
  // Unsplash-hosted previews: width descriptors + sizes, so a phone showing a 180 px card downloads and decodes
  // ~360 px instead of 960 px (the biggest cost while scrolling); q=70, auto WebP/AVIF from Unsplash's CDN
  if (/^https:\/\/images\.unsplash\.com\//.test(src)) {
    const at = (px: number) => src.replace(/([?&])w=\d+/, `$1w=${px}`).replace(/([?&])q=\d+/, '$1q=70');
    const max = Math.min(Math.max(w * 2, 480), 1200);
    const steps = [160, 240, 320, 400, 480, 640, 800, 1000, 1200].filter((x) => x <= max);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={at(Math.min(w, 480))} srcSet={steps.map((x) => `${at(x)} ${x}w`).join(', ')} sizes={sizes} alt={alt} width={w} height={h} className={className}
      loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : {})} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={w} height={h} className={className} loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : {})} />;
}
