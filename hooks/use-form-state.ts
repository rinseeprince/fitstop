"use client";

import { useState, useCallback } from "react";

type UseFormStateOptions<T> = {
  initialValues: T;
  onSubmit: (values: T) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

export function useFormState<T extends Record<string, unknown>>({
  initialValues,
  onSubmit,
  onSuccess,
  onError,
}: UseFormStateOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleChange = useCallback(
    <K extends keyof T>(field: K) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setValues((prev) => ({ ...prev, [field]: e.target.value }));
      },
    []
  );

  const reset = useCallback(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);

      try {
        await onSubmit(values);
        reset();
        onSuccess?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("Unknown error"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, onSubmit, reset, onSuccess, onError]
  );

  return {
    values,
    setValues,
    updateField,
    handleChange,
    reset,
    handleSubmit,
    isSubmitting,
  };
}
