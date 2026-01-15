import React from 'react';

interface WaitingScreenProps {
  message?: string | null;
}

export const WaitingScreen: React.FC<WaitingScreenProps> = ({ message }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900">
      {!message && (
        <>
          <div className="relative flex items-center justify-center">
            <div className="absolute animate-ping inline-flex h-16 w-16 rounded-full bg-blue-400 opacity-20"></div>
            <div className="relative inline-flex rounded-full h-8 w-8 bg-blue-500"></div>
          </div>
          <h2 className="mt-8 text-xl font-medium text-gray-300 animate-pulse">
            Waiting for partner...
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Connecting you to the secure channel.
          </p>
        </>
      )}
      {message && (
        <div className="text-center">
          <h2 className="text-xl font-medium text-red-300">
            {message}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Returning to start...
          </p>
        </div>
      )}
    </div>
  );
};
