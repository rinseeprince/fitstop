"use client"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Send, Calendar, Users, Eye } from "lucide-react"

export default function EmailPage() {
  const [subject, setSubject] = useState("")
  const [content, setContent] = useState("")

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Email Marketing</h1>
          <p className="text-muted-foreground mt-1">Compose and send newsletters to your clients</p>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-sm text-muted-foreground">Total Subscribers</p>
                <p className="text-2xl font-bold mt-1">156</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Send className="h-8 w-8 mx-auto mb-2 text-success" />
                <p className="text-sm text-muted-foreground">Sent This Month</p>
                <p className="text-2xl font-bold mt-1">8</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Eye className="h-8 w-8 mx-auto mb-2 text-accent" />
                <p className="text-sm text-muted-foreground">Avg Open Rate</p>
                <p className="text-2xl font-bold mt-1">68%</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Calendar className="h-8 w-8 mx-auto mb-2 text-warning" />
                <p className="text-sm text-muted-foreground">Scheduled</p>
                <p className="text-2xl font-bold mt-1">2</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="compose" className="space-y-6">
          <TabsList>
            <TabsTrigger value="compose">Compose</TabsTrigger>
            <TabsTrigger value="sent">Sent Emails</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          </TabsList>

          {/* Compose Tab */}
          <TabsContent value="compose" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>New Email Campaign</CardTitle>
                <CardDescription>Create and send an email to your client segments</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Audience Selection */}
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select defaultValue="all">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clients (24)</SelectItem>
                      <SelectItem value="active">Active Clients (20)</SelectItem>
                      <SelectItem value="leads">Leads Only (8)</SelectItem>
                      <SelectItem value="inactive">Inactive Clients (4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Subject Line */}
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject Line</Label>
                  <Input
                    id="subject"
                    placeholder="e.g., Your Weekly Workout Tips"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                {/* Email Content */}
                <div className="space-y-2">
                  <Label htmlFor="content">Email Content</Label>
                  <Textarea
                    id="content"
                    placeholder="Write your email content here..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-[300px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use simple formatting. Links and basic styling will be preserved.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button className="flex-1">
                    <Send className="h-4 w-4 mr-2" />
                    Send Now
                  </Button>
                  <Button variant="outline" className="flex-1 bg-transparent">
                    <Calendar className="h-4 w-4 mr-2" />
                    Schedule for Later
                  </Button>
                  <Button variant="outline" className="flex-1 bg-transparent">
                    <Eye className="h-4 w-4 mr-2" />
                    Preview
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Email Templates */}
            <Card>
              <CardHeader>
                <CardTitle>Email Templates</CardTitle>
                <CardDescription>Start with a pre-built template</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      title: "Weekly Newsletter",
                      description: "Share weekly tips and updates with your clients",
                    },
                    {
                      title: "Program Launch",
                      description: "Announce a new training program or service",
                    },
                    {
                      title: "Success Story",
                      description: "Highlight client transformations and testimonials",
                    },
                    {
                      title: "Special Offer",
                      description: "Promote limited-time discounts or packages",
                    },
                  ].map((template, i) => (
                    <div key={i} className="p-4 rounded-lg border">
                      <h3 className="font-medium mb-1">{template.title}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                      <Button variant="outline" size="sm">
                        Use Template
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sent Emails Tab */}
          <TabsContent value="sent" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Sent Campaigns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    {
                      subject: "Weekly Workout Tips - Week 12",
                      sent: "2 days ago",
                      recipients: 24,
                      opens: 18,
                      openRate: "75%",
                    },
                    {
                      subject: "New Training Programs Available",
                      sent: "1 week ago",
                      recipients: 24,
                      opens: 15,
                      openRate: "63%",
                    },
                    {
                      subject: "Client Success Story: Sarah's Journey",
                      sent: "2 weeks ago",
                      recipients: 24,
                      opens: 20,
                      openRate: "83%",
                    },
                  ].map((email, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{email.subject}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Sent {email.sent} to {email.recipients} recipients
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-sm font-medium">{email.opens}</p>
                          <p className="text-xs text-muted-foreground">Opens</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-success">{email.openRate}</p>
                          <p className="text-xs text-muted-foreground">Rate</p>
                        </div>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scheduled Tab */}
          <TabsContent value="scheduled" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Scheduled Campaigns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    {
                      subject: "Monthly Check-in Reminder",
                      scheduledFor: "Tomorrow at 9:00 AM",
                      recipients: 20,
                    },
                    {
                      subject: "Spring Program Launch",
                      scheduledFor: "Mar 1, 2024 at 10:00 AM",
                      recipients: 24,
                    },
                  ].map((email, i) => (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{email.subject}</h3>
                        <p className="text-sm text-muted-foreground mt-1">Scheduled for {email.scheduledFor}</p>
                        <p className="text-sm text-muted-foreground">{email.recipients} recipients</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
