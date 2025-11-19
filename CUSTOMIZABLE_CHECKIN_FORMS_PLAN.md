# Customizable Check-In Forms - Implementation Plan

## Difficulty Assessment: **Medium-High** (3-4 weeks for full implementation)

This is a substantial feature but very achievable given your existing architecture. The hybrid approach balances complexity with maintainability.

---

## Configuration Decisions

- **Customization Level:** Advanced - Full form builder with custom logic
- **Data Storage:** Hybrid - Core fields + JSONB for custom fields
- **Templates:** Multiple templates with assignment (coaches can create multiple forms and assign to specific clients)
- **Migration:** No migration needed - existing check-in data can be deleted

---

## Phase 1: Database & Type Foundation (3-5 days)

### 1.1 Create new database tables:

**form_templates** - Store form configurations per coach
- Columns: id, coach_id, name, description, is_default, created_at, updated_at

**form_fields** - Define fields within templates
- Columns: id, template_id, step_number, field_key, field_type, label, config (JSONB), validation_rules (JSONB), required, order

**client_form_assignments** - Assign templates to clients
- Columns: id, client_id, template_id, assigned_at

**Modify check_ins table** - Add custom_data JSONB column for dynamic fields

### 1.2 Update TypeScript types:
- Create `FormTemplate`, `FormField`, `FieldConfig` types
- Define field type enums (text, number, scale, emoji, photo, textarea, select, multiselect, date, etc.)
- Create validation rule types for conditional logic

### 1.3 Seed default template:
- Create migration that generates "Default Template" matching current check-in structure
- Auto-assign to existing coaches/clients

---

## Phase 2: Form Builder UI (5-7 days)

### 2.1 Template Management:
- Templates list page (`/app/templates/page.tsx`)
- Create/Edit template dialog with name, description
- Template selection when creating clients
- Duplicate template functionality

### 2.2 Drag-and-drop Form Builder:
- Step management (add/remove/reorder steps)
- Field palette with available field types
- Drag fields into steps
- Field configuration panel:
  - Label, placeholder, help text
  - Validation rules (required, min/max, regex)
  - Conditional logic (show if X field equals Y)
  - Default values

### 2.3 Field Type Components:
- Text input, number, textarea
- Scale slider (1-10, custom range)
- Emoji selector (custom emoji sets)
- Photo uploader (single/multiple)
- Select dropdown, multiselect
- Date picker, checkbox, radio buttons

### 2.4 Preview Mode:
- Live preview of form as coaches build it
- Test form submission without saving data

---

## Phase 3: Dynamic Form Rendering Engine (4-6 days)

### 3.1 Schema Generator:
- Function to convert form template to Zod schema
- Runtime validation for dynamic fields
- Handle conditional field validation

### 3.2 Dynamic Form Component:
- Replace hardcoded steps with dynamic renderer
- Map field types to UI components
- Implement conditional field visibility logic
- Auto-save state with localStorage (keep existing pattern)

### 3.3 Form Submission Handler:
- Parse dynamic fields from form state
- Validate against generated schema
- Save core fields to columns, custom fields to custom_data JSONB
- Handle photo uploads for dynamic photo fields

---

## Phase 4: Data Access & API Updates (2-3 days)

### 4.1 Service Layer Updates:
- `form-template-service.ts` - CRUD for templates
- Update `check-in-service.ts` to handle custom_data
- Create helper functions to merge core + custom fields

### 4.2 API Routes:
- `/api/templates` - List, create, update, delete templates
- `/api/templates/[id]/fields` - Manage template fields
- `/api/clients/[id]/assign-template` - Assign template to client
- Update check-in APIs to load template with submission

---

## Phase 5: Coach Dashboard Integration (2-3 days)

### 5.1 Check-in Display:
- Update check-in detail modal to render dynamic fields
- Group fields by steps from template
- Handle different field type displays

### 5.2 Charts & Analytics:
- Allow coaches to mark fields as "chartable"
- Dynamic chart generation for numeric/scale fields
- Comparison view for any chartable field over time

### 5.3 Client Assignment:
- Template selector in Add Client dialog
- Bulk assign template to multiple clients
- Change client's template (applies to future check-ins)

---

## Phase 6: AI Integration Updates (2-3 days)

### 6.1 Dynamic AI Prompts:
- Update AI summary generation to work with custom fields
- Include template field labels in AI context
- Configure which fields AI should focus on (per template setting)

### 6.2 AI Insights:
- Let coaches mark fields for AI analysis
- Generate insights based on custom field trends

---

## Phase 7: Advanced Features (3-4 days)

### 7.1 Conditional Logic Engine:
- Implement "show field X if field Y equals Z" logic
- Support multiple conditions (AND/OR)
- Calculated fields (e.g., BMI from height + weight)

### 7.2 Field Dependencies:
- Enable/disable fields based on other values
- Cascade validation rules

### 7.3 Template Versioning:
- Track template changes over time
- Clients always fill out the template version assigned to them
- View historical check-ins with their original template structure

---

## Phase 8: Polish & Testing (2-3 days)

### 8.1 Validation & Error Handling:
- Comprehensive error messages
- Form builder validation (prevent invalid configs)
- Handle edge cases (deleted fields, missing templates)

### 8.2 UX Enhancements:
- Empty states, loading states
- Help tooltips in form builder
- Keyboard shortcuts for form builder

### 8.3 Testing:
- Test template CRUD operations
- Test form rendering with various field combinations
- Test conditional logic edge cases
- Test data migration from old to new structure

---

## Technical Stack Additions Needed

- `@dnd-kit/core` + `@dnd-kit/sortable` - Drag-and-drop for form builder
- `react-colorful` or similar - If custom emoji/color pickers needed
- Consider `formkit/auto-animate` - Smooth field transitions

---

## Key Implementation Details

### Field Type Registry Pattern:
```typescript
const FIELD_TYPE_REGISTRY = {
  text: { component: TextInput, validator: z.string() },
  number: { component: NumberInput, validator: z.number() },
  scale: { component: ScaleSlider, validator: z.number().min(1).max(10) },
  emoji: { component: EmojiSelector, validator: z.number().min(1).max(5) },
  photo: { component: PhotoUploader, validator: z.string().url() },
  textarea: { component: TextArea, validator: z.string() },
  select: { component: Select, validator: z.string() },
  multiselect: { component: MultiSelect, validator: z.array(z.string()) },
  date: { component: DatePicker, validator: z.date() },
  checkbox: { component: Checkbox, validator: z.boolean() },
  // ...etc
}
```

### Template Structure (JSONB):
```json
{
  "steps": [
    {
      "id": "step-1",
      "title": "Wellness Check",
      "fields": ["mood", "energy", "custom-field-1"]
    }
  ],
  "fields": {
    "custom-field-1": {
      "type": "scale",
      "label": "Hunger Level",
      "config": { "min": 1, "max": 10 },
      "validation": { "required": true },
      "conditionalLogic": {
        "showIf": {
          "mood": { "lte": 2 }
        }
      }
    }
  }
}
```

### Database Schema Example:

```sql
-- form_templates table
CREATE TABLE form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- form_fields table
CREATE TABLE form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  label TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  validation_rules JSONB DEFAULT '{}',
  required BOOLEAN DEFAULT false,
  "order" INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- client_form_assignments table
CREATE TABLE client_form_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, template_id)
);

-- Add custom_data column to check_ins
ALTER TABLE check_ins ADD COLUMN custom_data JSONB DEFAULT '{}';
```

---

## Migration Strategy

Since existing check-in data can be deleted:

1. Drop existing check-ins via Supabase dashboard or migration
2. Modify check_ins schema to add custom_data column
3. Create new tables in one migration
4. Seed default template that matches original form structure
5. All future check-ins use new system

---

## Current Check-In Form Structure (for Default Template)

The current check-in form has 4 steps with these fields:

### Step 1: Subjective Metrics
- mood: 1-5 scale (emoji selector)
- energy: 1-10 scale (slider)
- sleep: 1-10 scale (slider)
- stress: 1-10 scale (slider)
- notes: Free text (optional)

### Step 2: Body Metrics
- weight: Number with unit selector (lbs/kg)
- weightUnit: "lbs" | "kg"
- bodyFatPercentage: Number (optional)
- Measurements: waist, hips, chest, arms, thighs (Numbers)
- measurementUnit: "in" | "cm"

### Step 3: Progress Photos
- photoFront: Image upload
- photoSide: Image upload
- photoBack: Image upload

### Step 4: Training Metrics
- workoutsCompleted: Number
- adherencePercentage: 0-100 scale (slider)
- prs: Free text (optional)
- challenges: Free text (optional)

---

## Risks & Mitigations

1. **Complexity creep** - Start with basic field types, add advanced features incrementally
2. **Performance** - Index JSONB columns for frequently queried custom fields
3. **Type safety loss** - Use Zod extensively for runtime validation
4. **UI complexity** - Build form builder iteratively, start with basic drag-drop

---

## Estimated Timeline: **3-4 weeks full-time**

The feature is definitely achievable! The hybrid database approach is smart - it maintains performance for common queries while giving you the flexibility needed. The existing architecture (strong typing, service layer, component modularity) sets you up well for this.

---

## Implementation Order Recommendation

For fastest MVP to full feature:

1. **Week 1:** Database schema + TypeScript types + seed default template
2. **Week 2:** Basic form builder UI (no conditional logic yet) + template management
3. **Week 3:** Dynamic form rendering engine + API updates + data access layer
4. **Week 4:** Conditional logic + AI integration + charts + polish

This allows you to have a working system by end of Week 2, then add advanced features incrementally.
