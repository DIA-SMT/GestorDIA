// Ejecuta una acción del asistente DESPUÉS de que el usuario la confirmó
// en la tarjeta del chat. Los args llegan ya normalizados por buildProposal.

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/data";
import { executeAction } from "@/lib/assistant-tools";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  let tool: string;
  let args: Record<string, unknown>;
  try {
    const body = await req.json();
    tool = String(body.tool);
    args = body.args ?? {};
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const result = await executeAction(tool, args, user.id);

  if (result.ok) {
    for (const p of ["/", "/pagos", "/servicios", "/rendicion"]) revalidatePath(p);
  }

  return Response.json(result);
}
