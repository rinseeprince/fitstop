export interface AutomationRule {
  id: string
  name: string
  trigger: {
    type: string
    description: string
  }
  action: {
    type: string
    description: string
  }
  isActive: boolean
  createdAt: Date
}
