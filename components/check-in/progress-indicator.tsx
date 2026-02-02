"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";

type ProgressIndicatorProps = {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
};

export const ProgressIndicator = ({
  currentStep,
  totalSteps,
  stepLabels = [],
}: ProgressIndicatorProps) => {
  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step, index) => (
          <div key={step} className="flex items-center flex-1">
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className={`
                  relative flex items-center justify-center w-10 h-10 rounded-full
                  border-2 transition-all duration-300
                  ${
                    step < currentStep
                      ? "bg-primary border-primary text-primary-foreground"
                      : step === currentStep
                      ? "bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/30"
                      : "bg-background border-border text-muted-foreground"
                  }
                `}
              >
                {step < currentStep ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-semibold">{step}</span>
                )}

                {step === currentStep && (
                  <motion.div
                    className="absolute -inset-1 rounded-full border-2 border-primary"
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 0, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                )}
              </motion.div>

              {/* Step Label (mobile hidden) */}
              {stepLabels[index] && (
                <span
                  className={`
                    mt-2 text-xs font-medium hidden sm:block text-center
                    ${
                      step === currentStep
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  `}
                >
                  {stepLabels[index]}
                </span>
              )}
            </div>

            {/* Connection Line */}
            {index < totalSteps - 1 && (
              <div className="flex-1 h-0.5 mx-2 relative">
                <div className="absolute inset-0 bg-border" />
                <motion.div
                  className="absolute inset-0 bg-primary origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{
                    scaleX: step < currentStep ? 1 : 0,
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Current Step Label (mobile only) */}
      {stepLabels[currentStep - 1] && (
        <div className="mt-4 text-center sm:hidden">
          <p className="text-sm font-medium text-foreground">
            {stepLabels[currentStep - 1]}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Step {currentStep} of {totalSteps}
          </p>
        </div>
      )}
    </div>
  );
};
