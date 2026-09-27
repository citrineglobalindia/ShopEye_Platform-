// SRS: CUST-FR-154 (product photos: responsive sizes and AVIF/WebP from Vercel's image CDN for ShopEye-hosted photos; lazy below the fold,
// eager with high priority for the main product photo; anything not hosted by ShopEye still lazy-loads as a plain image)
import Image from 'next/image';
const OPTIMISABLE = /^https:\/\/byaaaesufrneivzcsxtv\.supabase\.co\/storage\/v1\/object\/public\//;
export function Pic({ src, alt, w = 600, h = 750, sizes = '(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 260px', priority = false, className }:
  { src: string; alt: string; w?: number; h?: number; sizes?: string; priority?: boolean; className?: string }) {
  if (OPTIMISABLE.test(src)) return <Image src={src} alt={alt} width={w} height={h} sizes={sizes} priority={priority} className={className} />;
  // Unsplash-hosted previews: ask the image CDN for the size actually shown (and 2x for sharp screens)
  if (/^https:\/\/images\.unsplash\.com\//.test(src)) {
    const at = (px: number) => src.replace(/([?&])w=\d+/, `$1w=${px}`);
    const base = Math.min(w, 900) > 480 ? 480 : Math.min(w, 900);
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={at(base)} srcSet={`${at(base)} 1x, ${at(Math.min(base * 2, 1100))} 2x`} alt={alt} width={w} height={h} className={className}
      loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : {})} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={w} height={h} className={className} loading={priority ? 'eager' : 'lazy'} decoding="async" {...(priority ? { fetchPriority: 'high' as const } : {})} />;
}
