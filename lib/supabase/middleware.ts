import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const IS_DEMO =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Refresca la sesión en cada request y protege las rutas.
export async function updateSession(request: NextRequest) {
  // MODO DEMO: sin credenciales, no hay auth. Dejamos pasar todo,
  // y si alguien entra a /login lo mandamos al dashboard.
  if (IS_DEMO) {
    if (request.nextUrl.pathname.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
