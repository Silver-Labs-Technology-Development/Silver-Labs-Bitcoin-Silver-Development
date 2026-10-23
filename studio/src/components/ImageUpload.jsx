import React, { useState, useCallback } from 'react'

const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_DIMENSIONS = { width: 2000, height: 2000 }
const MAX_PIXELS = 4_000_000 // 4 megapixels

export function ImageUpload({ onChange, assetKind, value, disabled = false, label = 'Upload Logo' }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = React.useRef(null)

  const validateFile = useCallback((file) => {
    if (!SUPPORTED_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type}. Supported: PNG, JPEG, GIF, WebP`
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB. Maximum: 5 MB`
    }
    return null
  }, [])

  const validateImage = useCallback((file) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        if (img.width > MAX_DIMENSIONS.width || img.height > MAX_DIMENSIONS.height) {
          reject(`Image dimensions ${img.width}x${img.height} exceed maximum ${MAX_DIMENSIONS.width}x${MAX_DIMENSIONS.height}`)
          return
        }
        if (img.width * img.height > MAX_PIXELS) {
          reject(`Image has ${img.width * img.height} pixels, maximum is ${MAX_PIXELS}`)
          return
        }
        resolve({ width: img.width, height: img.height })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject('Invalid image file')
      }
      img.src = url
    })
  }, [])

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    const typeError = validateFile(file)
    if (typeError) {
      setError(typeError)
      return
    }

    setLoading(true)
    try {
      const dimensions = await validateImage(file)
      
      // Convert to base64 for preview
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      setPreview({ base64, file, dimensions })
      onChange({ file, base64, dimensions, assetKind })
    } catch (err) {
      setError(err.message)
      setPreview(null)
      onChange(null)
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = () => {
    setPreview(null)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onChange(null)
  }

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  return (
    <div className="image-upload">
      <label className="label">{label}</label>
      
      <div 
        className={`upload-area ${preview ? 'has-preview' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={handleFileSelect}
          disabled={disabled}
          style={{ display: 'none' }}
        />

        {preview ? (
          <div className="preview-container">
            <img src={preview.base64} alt="Logo preview" className="preview-image" />
            <div className="preview-info">
              <span>{preview.file.name}</span>
              <span>{preview.dimensions.width} × {preview.dimensions.height} px</span>
              <span>{(preview.file.size / 1024).toFixed(1)} KB</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary remove-btn"
              onClick={(e) => { e.stopPropagation(); handleRemove() }}
              disabled={loading}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="upload-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Click to upload or drag and drop
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
              PNG, JPEG, GIF, WebP · Max 5 MB · Max 2000×2000 px
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="upload-error" style={{ color: 'var(--error)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          {error}
        </p>
      )}

      {loading && (
        <p className="upload-loading" style={{ color: 'var(--warning)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Validating image...
        </p>
      )}
    </div>
  )
}

export function AssetLogoPreview({ imageUri, assetName }) {
  if (!imageUri) return null

  return (
    <div className="asset-logo-preview">
      <img src={imageUri} alt={`${assetName} logo`} style={{ width: '64px', height: '64px', borderRadius: '8px', objectFit: 'cover' }} />
    </div>
  )
}