import React from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Nodes from './pages/Nodes'
import TokenStudio from './pages/TokenStudio'
import Transactions from './pages/Transactions'

function App() {
  return (
    <div>
      <nav className="nav">
        <NavLink to="/" className="nav-logo">₿ Bitcoin Silver L2 Studio</NavLink>
        <div className="nav-links">
          <NavLink to="/" className="nav-link">Dashboard</NavLink>
          <NavLink to="/nodes" className="nav-link">Nodes</NavLink>
          <NavLink to="/tokens" className="nav-link">Token Studio</NavLink>
          <NavLink to="/transactions" className="nav-link">Transactions</NavLink>
        </div>
        <div style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>⚠ EXPERIMENTAL - Trusted Single-Operator</div>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/nodes" element={<Nodes />} />
        <Route path="/tokens" element={<TokenStudio />} />
        <Route path="/transactions" element={<Transactions />} />
      </Routes>
    </div>
  )
}

export default App
