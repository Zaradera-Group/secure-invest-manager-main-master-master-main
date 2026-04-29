// Basic Deno type definitions for Supabase Edge Functions
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): void
  namespace env {
    function get(key: string): string | undefined
  }
}

declare const Deno: typeof Deno;

// Web API types that Deno supports
declare interface Request extends globalThis.Request {}
declare interface Response extends globalThis.Response {}
declare interface Headers extends globalThis.Headers {}
declare interface URL extends globalThis.URL {}
declare interface URLSearchParams extends globalThis.URLSearchParams {}
