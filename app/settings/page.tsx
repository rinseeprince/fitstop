import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SettingsUnitsCard } from "@/components/coach/settings-units-card"

// NOTE: the Profile and Business cards below are still an unwired mock — no
// fetch, no save handler, hardcoded values. Only the Units card is real
// (units canonicalization Phase 4). Do not read the mock cards as a working
// pattern to copy.

const cardClass = "bg-white border-0 shadow-none rounded-[6px]"
const headerClass = "px-5 py-4 border-b border-[rgba(13,148,136,0.08)] flex items-center justify-between min-h-[64px]"
const titleClass = "text-[15px] font-semibold tracking-tight text-[#0c1a1e]"
const helperClass = "text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium"
const labelClass = "text-[12px] font-medium text-[#0c1a1e]"
const inputClass = "border-[rgba(13,148,136,0.08)] rounded-[6px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:border-[#0d9488] focus:ring-[#0d9488]/20"
const primaryButtonClass = "bg-[#0d9488] hover:bg-[#0d9488]/90 text-white rounded-[6px]"

export default function SettingsPage() {
  const pageHeader = (
    <PageHeader
      title="Settings"
      description="Manage your account and preferences"
    />
  )

  return (
    <AppLayout pageHeader={pageHeader}>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Profile Settings */}
          <Card className={cardClass}>
            <CardHeader className={headerClass}>
              <h3 className={titleClass}>Profile Information</h3>
              <span className={helperClass}>Update your personal details</span>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="space-y-2">
                <Label htmlFor="name" className={labelClass}>Full Name</Label>
                <Input id="name" defaultValue="Coach Name" className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className={labelClass}>Email</Label>
                <Input id="email" type="email" defaultValue="coach@example.com" className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio" className={labelClass}>Bio</Label>
                <Textarea id="bio" placeholder="Tell clients about yourself..." className={inputClass} />
              </div>
              <Button className={primaryButtonClass}>Save Changes</Button>
            </CardContent>
          </Card>

          {/* Business Settings */}
          <Card className={cardClass}>
            <CardHeader className={headerClass}>
              <h3 className={titleClass}>Business Information</h3>
              <span className={helperClass}>Configure your business details</span>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="space-y-2">
                <Label htmlFor="business" className={labelClass}>Business Name</Label>
                <Input id="business" placeholder="Your Coaching Business" className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className={labelClass}>Phone Number</Label>
                <Input id="phone" type="tel" placeholder="+1 (555) 123-4567" className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website" className={labelClass}>Website</Label>
                <Input id="website" type="url" placeholder="https://yourwebsite.com" className={inputClass} />
              </div>
              <Button className={primaryButtonClass}>Save Changes</Button>
            </CardContent>
          </Card>

          <SettingsUnitsCard />
        </div>
      </div>
    </AppLayout>
  )
}
