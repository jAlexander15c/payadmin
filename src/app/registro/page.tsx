import Registration from "@/components/registration";
import { initialRegistrationState } from "@/lib/initial-registration";
export const dynamic = "force-dynamic";
export default async function Page() {
  return <Registration state={await initialRegistrationState()} />;
}
