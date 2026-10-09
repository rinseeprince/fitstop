import { Suspense } from "react"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CoachAccountCard } from "@/components/coach/account-card"
import { ChangeEmailLinkNotice } from "@/components/auth/change-email-link-notice"
import {
  SETTINGS_CARD_CLASS,
  SETTINGS_CARD_HEADER_CLASS,
  SETTINGS_CARD_TITLE_CLASS,
} from "@/components/coach/settings-card-classes"
import { SettingsUnitsCard } from "@/components/coach/settings-units-card"
import { COACH_SETTINGS_PAGE } from "@/lib/constants"

// NOTE: the Business card below is still an unwired mock — no fetch, no save
// handler, hardcoded values. The Account and Units cards are real. Do not
// read the mock card as a working pattern to copy.

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
      {/* Says when a change-of-email link failed. Its own Suspense boundary:
          the reader of ?error= must not deopt the page's prerender. */}
      <Suspense fallback={null}>
        <ChangeEmailLinkNotice landing={COACH_SETTINGS_PAGE} />
      </Suspense>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <CoachAccountCard />

          {/* Business Settings */}
          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader className={SETTINGS_CARD_HEADER_CLASS}>
              <h3 className={SETTINGS_CARD_TITLE_CLASS}>Business Information</h3>
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
