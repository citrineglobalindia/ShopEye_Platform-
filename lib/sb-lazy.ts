'use client';
// The Supabase client (~50 kB) is fetched the first time a component actually talks to the database, not with the page
export const sbLazy = () => import('@/lib/sb-browser').then((m) => m.sb());
