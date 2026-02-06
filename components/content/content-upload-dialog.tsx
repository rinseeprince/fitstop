"use client";

import { useState, useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Link,
  FileText,
  Image,
  Video,
  ExternalLink,
  X,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ContentType, ContentFolder } from "@/types/content";

interface ContentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: ContentFolder[];
  onSuccess?: () => void;
}

interface FileUpload {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "completed" | "error";
  error?: string;
}

const ACCEPTED_FILE_TYPES = {
  "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/plain": [".txt"],
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function ContentUploadDialog({
  open,
  onOpenChange,
  folders,
  onSuccess,
}: ContentUploadDialogProps) {
  const [uploadType, setUploadType] = useState<"file" | "url">("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | undefined>(undefined);
  const [isLibrary, setIsLibrary] = useState(true);
  const [files, setFiles] = useState<FileUpload[]>([]);
  const [urlMetadata, setUrlMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    // Handle rejected files
    if (rejectedFiles.length > 0) {
      const error = rejectedFiles[0].errors[0];
      let errorMessage = "Invalid file";
      
      if (error.code === "file-too-large") {
        errorMessage = "File size must be less than 50MB";
      } else if (error.code === "file-invalid-type") {
        errorMessage = "File type not supported. Please use PDF, images, or documents.";
      }
      
      setError(errorMessage);
      toast({
        title: "File rejected",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    // Add valid files
    const newFiles = acceptedFiles.map((file) => ({
      file,
      progress: 0,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    setError("");

    // Auto-set title from first file if empty
    if (!title && newFiles.length > 0) {
      const fileName = newFiles[0].file.name.replace(/\.[^/.]+$/, "");
      setTitle(fileName);
    }
  }, [title, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const detectContentType = (file: File): ContentType => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type === "application/pdf") return "pdf";
    return "document";
  };

  const detectUrlType = (url: string): ContentType => {
    // YouTube
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      return "video_link";
    }
    // Vimeo
    if (url.includes("vimeo.com")) {
      return "video_link";
    }
    return "hyperlink";
  };

  const fetchUrlMetadata = async (url: string) => {
    try {
      setLoading(true);
      const response = await fetch("/api/content/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        const data = await response.json();
        setUrlMetadata(data.data);
        
        // Auto-fill title if empty
        if (!title && data.data.title) {
          setTitle(data.data.title);
        }
        if (!description && data.data.description) {
          setDescription(data.data.description);
        }
      }
    } catch (error) {
      console.error("Failed to fetch URL metadata:", error);
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async () => {
    const results = [];
    
    for (let i = 0; i < files.length; i++) {
      const fileUpload = files[i];
      
      // Update status to uploading
      setFiles((prev) => 
        prev.map((f, index) => 
          index === i ? { ...f, status: "uploading" } : f
        )
      );

      try {
        const formData = new FormData();
        formData.append("file", fileUpload.file);
        formData.append("title", i === 0 ? title : fileUpload.file.name);
        formData.append("description", i === 0 ? description : "");
        formData.append("type", detectContentType(fileUpload.file));
        formData.append("folderId", selectedFolder || "");
        formData.append("isLibrary", String(isLibrary));

        const response = await fetch("/api/content/upload", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          setFiles((prev) => 
            prev.map((f, index) => 
              index === i ? { ...f, status: "completed", progress: 100 } : f
            )
          );
          const data = await response.json();
          results.push(data.data);
        } else {
          throw new Error("Upload failed");
        }
      } catch (error) {
        setFiles((prev) => 
          prev.map((f, index) => 
            index === i ? { ...f, status: "error", error: "Upload failed" } : f
          )
        );
      }
    }

    return results;
  };

  const uploadUrl = async () => {
    try {
      const response = await fetch("/api/content/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          type: detectUrlType(url),
          url,
          folderId: selectedFolder,
          isLibrary,
          metadata: urlMetadata,
        }),
      });

      if (response.ok) {
        return await response.json();
      } else {
        throw new Error("Failed to create content");
      }
    } catch (error) {
      throw error;
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (uploadType === "url" && !url.trim()) {
      setError("URL is required");
      return;
    }

    if (uploadType === "file" && files.length === 0) {
      setError("Please select at least one file");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (uploadType === "file") {
        await uploadFiles();
      } else {
        await uploadUrl();
      }

      // Reset form
      setTitle("");
      setDescription("");
      setUrl("");
      setFiles([]);
      setUrlMetadata(null);
      setSelectedFolder(undefined);
      setIsLibrary(true);
      
      toast({
        title: "Content uploaded",
        description: uploadType === "file" ? 
          `Successfully uploaded ${files.length} file${files.length !== 1 ? "s" : ""}` :
          "Successfully added link",
      });
      
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to upload content. Please try again.";
      setError(errorMessage);
      
      toast({
        title: "Upload failed", 
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <Image className="h-4 w-4" />;
    if (file.type === "application/pdf") return <FileText className="h-4 w-4 text-red-600" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Content</DialogTitle>
          <DialogDescription>
            Upload files or add links to share with your clients
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Upload Type Selector */}
          <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
            <Button
              variant={uploadType === "file" ? "default" : "ghost"}
              onClick={() => setUploadType("file")}
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Upload Files
            </Button>
            <Button
              variant={uploadType === "url" ? "default" : "ghost"}
              onClick={() => setUploadType("url")}
              className="flex items-center gap-2"
            >
              <Link className="h-4 w-4" />
              Add Link
            </Button>
          </div>

          {uploadType === "file" && (
            <div className="space-y-4">
              {/* File Drop Zone */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm font-medium">
                  {isDragActive ? "Drop files here" : "Drag & drop files here, or click to select"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  PDF, images, and documents up to 50MB
                </p>
              </div>

              {/* File List */}
              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map((fileUpload, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 border rounded-lg"
                    >
                      {getFileIcon(fileUpload.file)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {fileUpload.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(fileUpload.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                        {fileUpload.status === "uploading" && (
                          <Progress value={fileUpload.progress} className="mt-1" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {fileUpload.status === "completed" && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                        {fileUpload.status === "error" && (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        {fileUpload.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploadType === "url" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="url"
                    placeholder="https://youtube.com/watch?v=... or any link"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fetchUrlMetadata(url)}
                    disabled={!url || loading}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {urlMetadata && (
                <div className="p-3 border rounded-lg bg-muted/50">
                  <div className="flex gap-3">
                    {urlMetadata.thumbnailUrl && (
                      <img
                        src={urlMetadata.thumbnailUrl}
                        alt="Preview"
                        className="w-16 h-12 object-cover rounded"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {urlMetadata.title || "Link Preview"}
                      </p>
                      {urlMetadata.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {urlMetadata.description}
                        </p>
                      )}
                      <Badge variant="outline" className="mt-1">
                        {detectUrlType(url) === "video_link" ? "Video" : "Link"}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Content Details */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="Enter content title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Folder</Label>
                <Select value={selectedFolder || "none"} onValueChange={(value) => setSelectedFolder(value === "none" ? undefined : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No folder</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Visibility</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch
                    checked={isLibrary}
                    onCheckedChange={setIsLibrary}
                  />
                  <span className="text-sm">
                    {isLibrary ? "Library (all clients)" : "Assignment only"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Uploading..." : "Add Content"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}