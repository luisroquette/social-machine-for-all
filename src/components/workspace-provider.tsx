'use client'

import { createContext, useContext } from 'react'

const WorkspaceContext = createContext<string>('')

export function WorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: React.ReactNode
}) {
  return (
    <WorkspaceContext.Provider value={workspaceId}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): string {
  return useContext(WorkspaceContext)
}
