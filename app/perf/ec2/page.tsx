import { redirect } from "next/navigation";

export default function Page() {
  redirect("/ec2?tab=health");
}
