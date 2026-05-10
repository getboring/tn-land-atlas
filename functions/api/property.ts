// POST /api/property: enriched parcel data from Supabase keyed by parcelKey.
//
// The runtime client `@supabase/supabase-js` is intentionally NOT a dep of
// this app; this file is the only place that talks to Supabase, via the
// REST endpoint with the anon key. The four reads (buildings, valuations,
// sales, property_entities -> entities) run in parallel. If any single
// table errors we substitute an empty array so the parcel detail panel can
// still render the parts that succeeded.
//
// When `SUPABASE_URL` / `SUPABASE_ANON_KEY` aren't configured the route
// returns an empty payload with a short cache. This is the path for local
// dev without secrets and for the "enriched data disabled" deploy mode.
//
// Security:
// - parcelKey flows through validateQuery (charset + length) plus
//   encodeURIComponent before composing into a Supabase URL.
// - entity_id values pulled from property_entities are validated as UUIDs
//   before being concatenated into the `in.(...)` filter. A compromise of
//   that table would otherwise become a URL-injection path.

import { validateQuery } from './_validate'

/** Pages Function environment bindings for this route. */
export interface Env {
  /** Supabase project URL, e.g. https://abc.supabase.co. Set in CF dashboard. */
  SUPABASE_URL: string
  /** Supabase anon (publishable) key. Set in CF dashboard. */
  SUPABASE_ANON_KEY: string
}

/**
 * Run a Supabase REST select against `table` with the given query string.
 * @throws on non-2xx response; callers wrap in `.catch(() => [])` so a
 *   per-table failure degrades the response gracefully.
 */
async function supabaseSelect<T>(env: Env, table: string, query: string): Promise<T> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`)
  url.search = query
  const res = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`Supabase ${table} error ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

interface PropertyEntityLink {
  entity_id: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { parcelKey } = (body ?? {}) as { parcelKey?: unknown }
  // Reuse the shared validator — same charset/length rules apply to GISLINK
  // (alphanumerics + spaces). encodeURIComponent below is the second line of
  // defense; validateQuery is the first.
  const validKey = validateQuery(parcelKey)
  if (!validKey) {
    return Response.json({ error: 'Invalid parcelKey' }, { status: 400 })
  }

  const env = context.env
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.json(
      { buildings: [], valuation: null, sales: [], entities: [] },
      { headers: { 'Cache-Control': 'public, max-age=30' } },
    )
  }

  const k = encodeURIComponent(validKey)
  const [buildings, valuations, sales, propertyEntities] = await Promise.all([
    supabaseSelect<unknown[]>(env, 'buildings', `select=*&parcel_key=eq.${k}`).catch(() => [] as unknown[]),
    supabaseSelect<unknown[]>(env, 'valuations', `select=*&parcel_key=eq.${k}`).catch(() => [] as unknown[]),
    supabaseSelect<unknown[]>(env, 'sales', `select=*&parcel_key=eq.${k}&price=gt.0&order=sale_date.desc`).catch(() => [] as unknown[]),
    supabaseSelect<PropertyEntityLink[]>(env, 'property_entities', `select=entity_id&parcel_key=eq.${k}`).catch(() => [] as PropertyEntityLink[]),
  ])

  let entities: unknown[] = []
  if (propertyEntities.length > 0) {
    // Defense in depth: validate every id looks like a UUID before
    // concatenating into the URL. Even though the data comes from our own
    // Supabase, a compromise of the property_entities table would otherwise
    // become a way to break out of the URL list.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const entityIds = propertyEntities
      .map((e) => e.entity_id)
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    if (entityIds.length > 0) {
      entities = await supabaseSelect<unknown[]>(
        env,
        'entities',
        `select=*&id=in.(${entityIds.join(',')})`,
      ).catch(() => [] as unknown[])
    }
  }

  return Response.json(
    {
      buildings,
      valuation: valuations[0] ?? null,
      sales,
      entities,
    },
    {
      headers: { 'Cache-Control': 'public, max-age=30' },
    },
  )
}
