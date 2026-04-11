import NavBar from '@/components/NavBar'

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ backgroundColor: '#F5F5F7' }}>
      <NavBar />
      {children}
    </main>
  )
}
