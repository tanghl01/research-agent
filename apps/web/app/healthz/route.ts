export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "operator-web",
    version: process.env.GITHUB_SHA ?? process.env.OPERATOR_DEPLOYED_GIT_COMMIT ?? "local",
    time: new Date().toISOString()
  });
}
