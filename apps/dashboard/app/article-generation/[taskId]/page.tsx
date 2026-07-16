import { ArticleGenerationView } from "@/components/article-generation-view";

export default async function ArticleGenerationPage({
  params
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return <ArticleGenerationView taskId={taskId} />;
}
