declare module 'next' {
  export type Metadata = any;
  export type Viewport = any;
  const content: any;
  export default content;
}

declare module 'next/link' {
  const Link: any;
  export default Link;
}

declare module 'next/image' {
  const Image: any;
  export default Image;
}

declare module 'next/navigation' {
  export function useRouter(): any;
  export function usePathname(): string;
  export function useSearchParams(): any;
  export function redirect(url: string): void;
  export function notFound(): void;
}

declare module 'next/font/google' {
  export const Inter: any;
  export const Roboto: any;
  export const Outfit: any;
}

declare module 'next/script' {
  const Script: any;
  export default Script;
}

declare module 'next/server' {
  export type NextRequest = any;
  export type NextResponse = any;
  export const NextResponse: any;
}

declare module 'next/server.js' {
  export type NextRequest = any;
  export type NextResponse = any;
  export const NextResponse: any;
}

declare module 'next/dist/lib/metadata/types/metadata-interface.js' {
  export type ResolvingMetadata = any;
  export type ResolvingViewport = any;
}
