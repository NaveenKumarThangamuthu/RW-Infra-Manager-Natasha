import RepoDetail from "@/components/screens/repositories/RepoDetail";

export default async function Page(props: { params: Promise<{ owner: string; name: string }> }) {
  const params = await props.params;
  return <RepoDetail owner={params.owner} name={params.name} />;
}
