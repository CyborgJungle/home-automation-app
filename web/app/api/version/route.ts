// The commit the live deployment was built from. The app compares it with its
// own build to know when Vercel has deployed something newer.
export function GET() {
  return Response.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
