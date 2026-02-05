"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Search,
  Video,
  ExternalLink,
  FileText,
  Image,
  Download,
  Folder,
  FolderOpen,
  Star,
  Play,
} from "lucide-react";
import type { ClientResourcesResponse, ContentItem } from "@/types/content";

export default function ClientResourcesPage() {
  const [resources, setResources] = useState<ClientResourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [expandedAssigned, setExpandedAssigned] = useState(true);

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/client/resources");
      if (response.ok) {
        const data = await response.json();
        setResources(data.data);
      }
    } catch (error) {
      console.error("Error fetching resources:", error);
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
        return "bg-red-500/10 text-red-600 border-red-200";
      case "hyperlink":
        return "bg-blue-500/10 text-blue-600 border-blue-200";
      case "pdf":
      case "document":
        return "bg-gray-500/10 text-gray-600 border-gray-200";
      case "image":
        return "bg-green-500/10 text-green-600 border-green-200";
      default:
        return "bg-gray-500/10 text-gray-600 border-gray-200";
    }
  };

  const handleContentClick = async (item: ContentItem) => {
    try {
      if (item.type === "video_link" || item.type === "hyperlink") {
        if (item.url) {
          window.open(item.url, "_blank");
        }
        return;
      }

      // For files, get signed URL from API
      const response = await fetch(`/api/content/download/${item.id}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data.url) {
          window.open(data.data.url, "_blank");
        }
      }
    } catch (error) {
      console.error("Error opening content:", error);
    }
  };

  const filterContent = (items: ContentItem[]) => {
    return items.filter((item) => {
      const matchesSearch = searchQuery === "" || 
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesType = selectedType === "all" || item.type === selectedType;
      
      return matchesSearch && matchesType;
    });
  };

  const ContentCard = ({ item, isAssigned = false }: { item: ContentItem; isAssigned?: boolean }) => (
    <Card 
      className="group cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/20"
      onClick={() => handleContentClick(item)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg border ${getContentTypeColor(item.type)}`}>
            {getContentIcon(item.type)}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                {item.title}
              </h4>
              {isAssigned && (
                <Star className="h-4 w-4 text-yellow-500 flex-shrink-0 ml-2" />
              )}
            </div>
            
            {item.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {item.description}
              </p>
            )}
            
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                {item.type === "video_link" ? "Video" : 
                 item.type === "hyperlink" ? "Link" :
                 item.type === "pdf" ? "PDF" :
                 item.type === "image" ? "Image" : "Document"}
              </Badge>
              
              {item.type === "video_link" && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                  <Play className="h-3 w-3 mr-1" />
                  Watch
                </Button>
              )}
              
              {(item.type === "pdf" || item.type === "document" || item.type === "image") && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                  <Download className="h-3 w-3 mr-1" />
                  View
                </Button>
              )}
              
              {item.type === "hyperlink" && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const assignedContent = resources?.assignedContent || [];
  const libraryContent = resources?.libraryContent;
  const filteredAssigned = filterContent(assignedContent);
  const filteredLibraryItems = libraryContent ? filterContent(libraryContent.rootItems) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Resources</h1>
        <p className="text-muted-foreground">
          Access videos, guides, and materials from your coach
        </p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search resources..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2">
          <Button 
            variant={selectedType === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType("all")}
          >
            All
          </Button>
          <Button 
            variant={selectedType === "video_link" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType("video_link")}
          >
            Videos
          </Button>
          <Button 
            variant={selectedType === "pdf" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType("pdf")}
          >
            Documents
          </Button>
          <Button 
            variant={selectedType === "hyperlink" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType("hyperlink")}
          >
            Links
          </Button>
        </div>
      </div>

      {/* Assigned Content Section */}
      {filteredAssigned.length > 0 && (
        <div className="space-y-4">
          <div 
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setExpandedAssigned(!expandedAssigned)}
          >
            <Star className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Assigned to You</h2>
            <Badge variant="secondary" className="ml-2">
              {filteredAssigned.length}
            </Badge>
          </div>
          
          {expandedAssigned && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAssigned.map((item) => (
                <ContentCard key={item.id} item={item} isAssigned={true} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Library Content Section */}
      {filteredLibraryItems.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Coach Library</h2>
            <Badge variant="outline" className="ml-2">
              {filteredLibraryItems.length}
            </Badge>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredLibraryItems.map((item) => (
              <ContentCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredAssigned.length === 0 && filteredLibraryItems.length === 0 && (
        <div className="text-center py-12">
          <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">
            {searchQuery ? "No matching resources" : "No resources yet"}
          </h3>
          <p className="text-muted-foreground">
            {searchQuery 
              ? "Try adjusting your search or filter criteria."
              : "Your coach hasn't shared any resources yet. Check back later!"
            }
          </p>
        </div>
      )}
    </div>
  );
}