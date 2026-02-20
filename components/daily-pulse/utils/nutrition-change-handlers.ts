export function createNutritionChangeHandlers(
  onNutritionChange: (data: {
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }) => void,
  currentData: {
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }
) {
  const handleCaloriesChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      ...currentData,
      caloriesConsumed: numValue,
    });
  };

  const handleProteinChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      ...currentData,
      proteinG: numValue,
    });
  };

  const handleCarbsChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      ...currentData,
      carbsG: numValue,
    });
  };

  const handleFatChange = (value: string) => {
    const numValue = value === "" ? null : parseInt(value, 10);
    onNutritionChange({
      ...currentData,
      fatG: numValue,
    });
  };

  return {
    handleCaloriesChange,
    handleProteinChange,
    handleCarbsChange,
    handleFatChange,
  };
}