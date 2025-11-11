import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ClientStatusBadge } from "@/components/client-status-badge"
import { EngagementIndicator } from "@/components/engagement-indicator"
import { Search, Plus, Send, MessageSquare, Eye } from "lucide-react"
import Link from "next/link"

const mockClients = [
  { id: 1, name: "Sarah Johnson", status: "active" as const, lastCheckIn: "2 days ago", engagement: "high" as const },
  { id: 2, name: "Mike Chen", status: "active" as const, lastCheckIn: "5 days ago", engagement: "medium" as const },
  { id: 3, name: "Emma Davis", status: "lead" as const, lastCheckIn: "Never", engagement: "low" as const },
  { id: 4, name: "James Wilson", status: "active" as const, lastCheckIn: "1 day ago", engagement: "high" as const },
  { id: 5, name: "Lisa Anderson", status: "active" as const, lastCheckIn: "3 days ago", engagement: "medium" as const },
  { id: 6, name: "Tom Martinez", status: "inactive" as const, lastCheckIn: "30 days ago", engagement: "low" as const },
  { id: 7, name: "Anna Taylor", status: "active" as const, lastCheckIn: "1 day ago", engagement: "high" as const },
  { id: 8, name: "David Brown", status: "lead" as const, lastCheckIn: "Never", engagement: "medium" as const },
]

export default function ClientsPage() {
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Clients</h1>
            <p className="text-muted-foreground mt-1">Manage and track your client relationships</p>
          </div>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add New Client
          </Button>
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search clients..." className="pl-9" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline">All</Button>
                <Button variant="outline">Active</Button>
                <Button variant="outline">Leads</Button>
                <Button variant="outline">Inactive</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Client List */}
        <Card>
          <CardHeader>
            <CardTitle>Client List ({mockClients.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="pb-3 text-left text-sm font-medium text-muted-foreground">Name</th>
                    <th className="pb-3 text-left text-sm font-medium text-muted-foreground">Status</th>
                    <th className="pb-3 text-left text-sm font-medium text-muted-foreground">Last Check-In</th>
                    <th className="pb-3 text-left text-sm font-medium text-muted-foreground">Engagement</th>
                    <th className="pb-3 text-right text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mockClients.map((client) => (
                    <tr key={client.id} className="border-b last:border-0">
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                            {client.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="font-medium">{client.name}</span>
                        </div>
                      </td>
                      <td className="py-4">
                        <ClientStatusBadge status={client.status} />
                      </td>
                      <td className="py-4 text-sm text-muted-foreground">{client.lastCheckIn}</td>
                      <td className="py-4">
                        <EngagementIndicator level={client.engagement} />
                      </td>
                      <td className="py-4">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/clients/${client.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm">
                            <Send className="h-4 w-4 mr-1" />
                            Check-In
                          </Button>
                          <Button variant="ghost" size="sm">
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-4 lg:hidden">
              {mockClients.map((client) => (
                <Card key={client.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium">
                            {client.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div>
                            <p className="font-medium">{client.name}</p>
                            <ClientStatusBadge status={client.status} />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Last check-in:</span>
                        <span>{client.lastCheckIn}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Engagement:</span>
                        <EngagementIndicator level={client.engagement} />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 bg-transparent" asChild>
                          <Link href={`/clients/${client.id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            View Profile
                          </Link>
                        </Button>
                        <Button variant="outline" size="sm">
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
