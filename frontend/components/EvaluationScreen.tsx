import React, { useState } from 'react';
import { Condition } from '../types';

interface EvaluationScreenProps {
  condition: Condition;
  onSubmit: (rating: number) => void;
}

export const EvaluationScreen: React.FC<EvaluationScreenProps> = ({ condition, onSubmit }) => {
  const [rating, setRating] = useState<number | null>(null);

  const getQuestion = () => {
    if (condition === Condition.ELIZA_VS_GEMINI) {
      return "How much did you feel like you were talking to a 'classic' mechanical program versus a modern intelligent agent?";
    } else {
      return "To what extent did you believe you were interacting with a real human student?";
    }
  };

  const getLabels = () => {
    if (condition === Condition.ELIZA_VS_GEMINI) {
        return ["Definitely Classic Eliza", "Definitely Modern AI"];
    } else {
        return ["Definitely AI", "Definitely Human"];
    }
  };

  const [leftLabel, rightLabel] = getLabels();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-6">
      <div className="w-full max-w-2xl bg-gray-800 rounded-xl p-8 shadow-2xl border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">Session Complete</h2>
        
        <p className="text-gray-300 text-lg mb-8 text-center leading-relaxed">
          {getQuestion()}
        </p>

        <div className="flex flex-col space-y-6">
          <div className="flex justify-between text-xs text-gray-500 uppercase font-semibold tracking-wider px-2">
            <span>{leftLabel}</span>
            <span>{rightLabel}</span>
          </div>
          
          <div className="flex justify-between items-center bg-gray-900 rounded-full p-2 border border-gray-700">
            {[1, 2, 3, 4, 5, 6, 7].map((num) => (
              <button
                key={num}
                onClick={() => setRating(num)}
                className={`
                  w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all duration-200
                  ${rating === num 
                    ? 'bg-blue-600 text-white scale-110 shadow-lg ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' 
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}
                `}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => rating && onSubmit(rating)}
          disabled={!rating}
          className="mt-10 w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
        >
          Submit Evaluation
        </button>
      </div>
    </div>
  );
};
