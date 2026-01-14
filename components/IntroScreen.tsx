import React from 'react';
import { Condition } from '../types';

interface IntroScreenProps {
  onSelectCondition: (condition: Condition) => void;
}

export const IntroScreen: React.FC<IntroScreenProps> = ({ onSelectCondition }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-6 text-center">
      <h1 className="text-3xl md:text-5xl font-bold text-gray-100 mb-6 tracking-tight">
        SymSys Modified Turing Test
      </h1>
      <p className="text-gray-400 mb-12 max-w-lg text-lg">
        Welcome to the Symbolic Systems 1 cognitive science experiment. 
        You will be paired with an agent. Your goal is to interact with them for 3 minutes 
        and then evaluate the interaction.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        <button
          onClick={() => onSelectCondition(Condition.ELIZA_VS_GEMINI)}
          className="group relative flex flex-col items-center p-8 bg-gray-800 border-2 border-gray-700 rounded-xl hover:border-blue-500 hover:bg-gray-750 transition-all duration-300"
        >
          <div className="h-12 w-12 mb-4 text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Condition 1: Eliza vs. Gemini</h2>
          <p className="text-gray-400 text-sm">
            You will be paired with either the classic Eliza chatbot or a modern AI imitating her.
          </p>
        </button>

        <button
          onClick={() => onSelectCondition(Condition.GEMINI_VS_STANFORD)}
          className="group relative flex flex-col items-center p-8 bg-gray-800 border-2 border-gray-700 rounded-xl hover:border-green-500 hover:bg-gray-750 transition-all duration-300"
        >
          <div className="h-12 w-12 mb-4 text-green-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Condition 2: Gemini vs. Stanford</h2>
          <p className="text-gray-400 text-sm">
            You will be paired with either a Gemini AI posing as a student or a real Stanford student.
          </p>
        </button>
      </div>
    </div>
  );
};
