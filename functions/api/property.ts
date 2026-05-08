export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

async function supabaseFetch(env: Env, path: string, body: object) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`Supabase ${path} error ${res.status}: ${text}`)
  }
  return res.json()
}

async function supabaseSelect(env: Env, table: string, query: string) {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`)
  url.search = query
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`Supabase ${table} error ${res.status}: ${text}`)
  }
  return res.json()
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { parcelKey } = await context.request.json()
    if (!parcelKey) return new Response(JSON.stringify({ error: 'Missing parcelKey' }), { status: 400 })

    const env = context.env
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return new Response(
        JSON.stringify({ buildings: [], valuation: null, sales: [], entities: [] }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const [buildings, valuations, sales, propertyEntities] = await Promise.all([
      supabaseSelect(env, 'buildings', `select=*&parcel_key=eq.${encodeURIComponent(parcelKey)}`).catch(() => []),
      supabaseSelect(env, 'valuations', `select=*&parcel_key=eq.${encodeURIComponent(parcelKey)}`).catch(() => []),
      supabaseSelect(env, 'sales', `select=*&parcel_key=eq.${encodeURIComponent(parcelKey)}&price=gt.0&order=sale_date.desc`).catch(() => []),
      supabaseSelect(env, 'property_entities', `select=entity_id&parcel_key=eq.${encodeURIComponent(parcelKey)}`).catch(() => []),
    ])

    let entities: unknown[] = []
    if (Array.isArray(propertyEntities) && propertyEntities.length > 0) {
      const entityIds = propertyEntities.map((e: { entity_id: string }) => e.entity_id).join(',')
      entities = await supabaseSelect(env, 'entities', `select=*&id=in.(${entityIds})`).catch(() => [])
    }

    return new Response(
      JSON.stringify({
        buildings: Array.isArray(buildings) ? buildings : [],
        valuation: Array.isArray(valuations) ? valuations[0] ?? null : null,
        sales: Array.isArray(sales) ? sales : [],
        entities: Array.isArray(entities) ? entities : [],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30',
        },
      }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}
