"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  FolderPlus,
  Grid,
  List,
  Search,
  Filter,
  Upload,
  Link,
  FileText,
  Image,
  Video,
  ExternalLink,
  MoreHorizontal,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { ContentLibraryResponse, ContentItem, ContentFolder } from "@/types/content";

export default function ContentLibraryPage() {
  const [library, setLibrary] = useState<ContentLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string; }[]>([
    { id: null, name: "Content Library" }
  ]);

  useEffect(() => {
    fetchContent();
  }, []);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/content/library");
      if (response.ok) {
        const data = await response.json();
        setLibrary(data.data);
      }
    } catch (error) {
      console.error("Error fetching content library:", error);
    } finally {
      setLoading(false);
    }
  };

  const getContentIcon = (type: string) => {
    switch (type) {
      case "video_link":
        return <Video className="h-4 w-4" />;
      case "hyperlink":
        return <ExternalLink className="h-4 w-4" />;
      case "pdf":
      case "document":
        return <FileText className="h-4 w-4" />;
      case "image":
        return <Image className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getContentTypeColor = (type: string) => {
    switch (type) {
      case "video_link":
        return "bg-red-500/10 text-red-600";
      case "hyperlink":
        return "bg-blue-500/10 text-blue-600";
      case "pdf":
      case "document":
        return "bg-gray-500/10 text-gray-600";
      case "image":
        return "bg-green-500/10 text-green-600";
      default:
        return "bg-gray-500/10 text-gray-600";
    }
  };

  const getCurrentFolderData = () => {
    if (!currentFolder || !library) {
      return {
        folders: library?.folders || [],
        items: library?.rootItems || [],
      };
    }

    const findFolder = (folders: any[], id: string): any => {
      for (const folder of folders) {
        if (folder.id === id) return folder;
        if (folder.subfolders) {
          const found = findFolder(folder.subfolders, id);
          if (found) return found;
        }
      }
      return null;
    };

    const folder = findFolder(library.folders, currentFolder);
    return {
      folders: folder?.subfolders || [],
      items: folder?.items || [],
    };
  };

  const navigateToFolder = (folder: ContentFolder | null) => {
    if (folder) {
      setCurrentFolder(folder.id);
      setBreadcrumbs([
        { id: null, name: "Content Library" },
        { id: folder.id, name: folder.name },
      ]);
    } else {
      setCurrentFolder(null);
      setBreadcrumbs([{ id: null, name: "Content Library" }]);
    }
  };

  const filteredData = () => {
    const { folders, items } = getCurrentFolderData();
    
    if (!searchQuery) return { folders, items };

    return {
      folders: folders.filter((folder: ContentFolder) =>
        folder.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
      items: items.filter((item: ContentItem) =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    };
  };

  const pageHeader = (
    <PageHeader
      title="Content Library"
      description="Organize and share resources with your clients"
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}>
            {viewMode === "grid" ? <List className="h-4 w-4" /> : <Grid className="h-4 w-4" />}
          </Button>
          <Button variant="outline">
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Content
          </Button>
        </div>
      }
    />
  );

  if (loading) {
    return (
      <AppLayout pageHeader={pageHeader}>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  const { folders, items } = filteredData();

  return (
    <AppLayout pageHeader={pageHeader}>
      <div className="space-y-6">
        {/* Breadcrumbs */}
        {breadcrumbs.length > 1 && (
          <nav className="flex items-center space-x-2 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id || "root"} className="flex items-center">
                {index > 0 && <span className="mx-2">/</span>}
                <button
                  onClick={() => {
                    if (index === 0) {
                      navigateToFolder(null);
                    }
                  }}
                  className={index === breadcrumbs.length - 1 ? "text-foreground" : "hover:text-foreground"}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search content..."
              className="w-full pl-9 pr-4 py-2 border border-input rounded-md bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>

        {/* Empty State */}
        {folders.length === 0 && items.length === 0 && !searchQuery && (
          <div className="text-center py-12">
            <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No content yet</h3>
            <p className="text-muted-foreground mb-6">
              Start building your content library by adding videos, documents, or links.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline">
                <FolderPlus className="h-4 w-4 mr-2" />
                Create Folder
              </Button>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Content
              </Button>
            </div>
          </div>
        )}

        {/* Folders and Content Grid */}
        {(folders.length > 0 || items.length > 0) && (
          <div className={viewMode === "grid" 
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "space-y-2"
          }>
            {/* Folders */}
            {folders.map((folder: ContentFolder) => (
              <Card
                key={folder.id}
                className="cursor-pointer transition-colors hover:bg-muted/50"
                onClick={() => navigateToFolder(folder)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                      <Folder className="h-5 w-5 text-yellow-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{folder.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {/* This would need to be calculated */}
                        0 items
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Content Items */}
            {items.map((item: ContentItem) => (
              <Card key={item.id} className="group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${getContentTypeColor(item.type)}`}>
                        {getContentIcon(item.type)}
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {item.type.replace("_", " ")}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <h4 className="font-medium mb-1 line-clamp-2">{item.title}</h4>
                  {item.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    {item.isLibrary ? (
                      <Badge variant="outline" className="text-xs">Library</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Assigned</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}