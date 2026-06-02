import { ArticleWorkbench } from "@/components/article-workbench";
import { getArticleData, getCoverData, getTitlesData } from "@/lib/dashboard-data";

export default async function ArticlePage() {
  const [article, titleData, cover] = await Promise.all([
    getArticleData(),
    getTitlesData(),
    getCoverData()
  ]);

  return (
    <div className="space-y-4">
      <ArticleWorkbench article={article} titleData={titleData} cover={cover} />
    </div>
  );
}
