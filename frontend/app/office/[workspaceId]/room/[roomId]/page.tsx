import { ComingSoon } from "@/components/common/ComingSoon";
import { api } from "@/lib/mock";

export function generateStaticParams() {
  return api.office.staticRoomParams();
}

export default function Page() {
  return <ComingSoon title="Meeting room" step={3} />;
}
