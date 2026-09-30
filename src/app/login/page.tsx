import Login from "@/components/login";
import { initialRegistrationState } from "@/lib/initial-registration";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const state = await initialRegistrationState();
  return (
    <Login
      registrationAvailable={state === "available"}
      created={(await searchParams).created === "1"}
    />
  );
}
