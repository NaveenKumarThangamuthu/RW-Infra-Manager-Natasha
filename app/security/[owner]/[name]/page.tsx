import RepoDetail from "@/components/screens/repositories/RepoDetail";

export default function Page({ params }: { params: { owner: string; name: string } }) {
  return <RepoDetail owner={params.owner} name={params.name} />;
}
